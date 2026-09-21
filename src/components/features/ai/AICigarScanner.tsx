import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Spin, Card, Typography, Space, App, Tag, Divider, Upload, AutoComplete, Image, Modal, Input } from 'antd';
import { CameraOutlined, ReloadOutlined, ThunderboltFilled, ThunderboltOutlined, LoadingOutlined, UploadOutlined, SwapOutlined, EditOutlined, DownloadOutlined, ShareAltOutlined, SearchOutlined } from '@ant-design/icons';
import Webcam from 'react-webcam';
import { useTranslation } from 'react-i18next';
import { analyzeCigarImage, CigarAnalysisResult } from '../../../services/gemini/cigarRecognition';
import { getCigars, getBrands } from '../../../services/firebase/firestore';
import { findCigarByBrandAndName } from '../../../services/aiCigarStorage';
import { getAppConfig } from '../../../services/firebase/appConfig';
import { searchCigarByText } from '../../../services/cigar/cigarTextSearch';
import { saveRecognitionToCigarDatabase, getAggregatedCigarData, generateProductName, type AggregatedCigarData } from '../../../services/cigar/cigarDataAggregation';
import { incrementUserCigarScanCount } from '../../../services/user/userAiStats';
import { useAuthStore } from '../../../store/modules/auth';
import type { UploadProps } from 'antd';
import type { Cigar, Brand } from '../../../types';

const { Title, Text, Paragraph } = Typography;

export const AICigarScanner: React.FC = () => {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { user } = useAuthStore();
    const webcamRef = useRef<Webcam>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const videoTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenshotContainerRef = useRef<HTMLDivElement>(null);
    const [savingScreenshot, setSavingScreenshot] = useState(false);
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<CigarAnalysisResult | null>(null);
    const [aggregatedData, setAggregatedData] = useState<AggregatedCigarData | null>(null);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [flashEnabled, setFlashEnabled] = useState(false);
    const [flashSupported, setFlashSupported] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<{
        matched: boolean;
        dataComplete: boolean;
        cigarIds: string[];
        cigars?: Cigar[];
    } | null>(null);
    const [userHint, setUserHint] = useState<string>('');
    const [cigars, setCigars] = useState<Cigar[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [matchedCigars, setMatchedCigars] = useState<Cigar[]>([]);
    const [dataStorageEnabled, setDataStorageEnabled] = useState<boolean>(true);

    // 保存识别结果到数据库（内部函数，不暴露给用户）
    // 必须在 handleAnalyze 之前定义，避免依赖循环
    const saveRecognitionResult = useCallback(async (recognitionResult: CigarAnalysisResult, imageSource: string) => {
        // 检查是否启用数据存储
        if (!dataStorageEnabled) {
            message.info(t('aiScanner.dataStorageDisabled'));
            return;
        }

        setSaving(true);
        try {
            // AI识笳仅保存到 cigar_database（不操作 cigars collection）
            // 🆕 传递用户信息
            await saveRecognitionToCigarDatabase(
                recognitionResult,
                user?.id,
                user?.displayName || undefined
            );
            
            // 保存后立即查询聚合数据
            const productName = generateProductName(recognitionResult.brand, recognitionResult.name);
            const aggregated = await getAggregatedCigarData(productName);
            
            if (aggregated) {
                setAggregatedData(aggregated);
                message.success(t('aiScanner.savedWithStats', { count: aggregated.totalRecognitions }));
                } else {
                message.success(t('aiScanner.savedToDb'));
            }
        } catch (error) {
            message.error(t('aiScanner.saveFailed', { error: error instanceof Error ? error.message : '' }));
        } finally {
            setSaving(false);
        }
    }, [dataStorageEnabled, user?.id, user?.displayName]);

    // 加载品牌和雪茄列表用于自动完成
    useEffect(() => {
        const loadSuggestions = async () => {
            setLoadingSuggestions(true);
            try {
                const [cigarsData, brandsData] = await Promise.all([
                    getCigars({ limit: 500 }),
                    getBrands({ limit: 200 }),
                ]);
                setCigars(cigarsData);
                setBrands(brandsData);
            } catch (error) {
                // Silently fail
            } finally {
                setLoadingSuggestions(false);
            }
        };
        loadSuggestions();
    }, []);

    // 加载 AI识茄 数据存储配置
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const config = await getAppConfig();
                if (config) {
                    setDataStorageEnabled(config.aiCigar?.enableDataStorage ?? true);
                }
            } catch (error) {
                // Silently fail
            }
        };
        loadConfig();
    }, []);

    // 生成自动完成选项
    const autocompleteOptions = useMemo(() => {
        const options: Array<{ value: string; label: string }> = [];
        
        // 添加品牌选项
        brands.forEach(brand => {
            options.push({
                value: brand.name,
                label: t('aiScanner.brandOptionLabel', { name: brand.name, country: brand.country ? ` (${brand.country})` : '' })
            });
        });
        
        // 添加雪茄选项（品牌 + 名称）
        cigars.forEach(cigar => {
            const fullName = cigar.brand && cigar.name 
                ? `${cigar.brand} ${cigar.name}`
                : cigar.name || '';
            if (fullName) {
                options.push({
                    value: fullName,
                    label: t('aiScanner.cigarOptionLabel', { name: fullName, size: cigar.size ? ` (${cigar.size})` : '' })
                });
            }
        });
        
        // 去重并按字母排序
        const uniqueOptions = Array.from(
            new Map(options.map(opt => [opt.value, opt])).values()
        ).sort((a, b) => a.value.localeCompare(b.value));
        
        return uniqueOptions;
    }, [brands, cigars]);

    // 过滤自动完成选项
    const filterOptions = (inputValue: string) => {
        if (!inputValue) return autocompleteOptions;
        const lowerInput = inputValue.toLowerCase();
        return autocompleteOptions.filter(opt => 
            opt.value.toLowerCase().includes(lowerInput) ||
            opt.label.toLowerCase().includes(lowerInput)
        );
    };

    const handleAnalyze = useCallback(async (imageSrc: string) => {
        setAnalyzing(true);
        setResult(null);
        setSaveStatus(null); // 重置保存状态
        setMatchedCigars([]); // 重置匹配的雪茄
        try {
            // 如果用户提供了提示，传递给识别函数
            const data = await analyzeCigarImage(imageSrc, userHint || undefined);
            setResult(data);
            
            // 更新用户 AI 识茄使用统计
            if (user?.id) {
                incrementUserCigarScanCount(user.id);
            }
            
            // 新逻辑：保存到 cigar_database 并加载聚合数据
            if (dataStorageEnabled) {
                try {
                    // 🆕 传递用户信息
                    await saveRecognitionToCigarDatabase(
                        data,
                        user?.id,
                        user?.displayName || undefined
                    );
                    
                    // 保存后立即查询聚合数据
                    const productName = generateProductName(data.brand, data.name);
                    const aggregated = await getAggregatedCigarData(productName);
            
             if (aggregated) {
                 setAggregatedData(aggregated);
                 message.success(t('aiScanner.recognitionSuccessWithStats', { count: aggregated.totalRecognitions }));
             }
                } catch (error) {
                    message.warning(t('aiScanner.statsUpdateFailed'));
                }
            }
            
            // 尝试查找匹配的雪茄以获取图片
            try {
                const matchedCigar = await findCigarByBrandAndName(data.brand, data.name);
                if (matchedCigar) {
                    setMatchedCigars([matchedCigar]);
                }
            } catch (error) {
                // Silently fail
            }
            
            // 根据可信度显示提示
            if (data.confidence < 0.5) {
                message.warning(t('aiScanner.lowConfidence'));
            }
        } catch (error) {
            message.error(t('aiScanner.recognitionFailed'));
            setImgSrc(null); // Reset to camera
        } finally {
            setAnalyzing(false);
        }
    }, [saveRecognitionResult, userHint]);

    const capture = useCallback(() => {
        if (webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot();
            if (imageSrc) {
                setImgSrc(imageSrc);
                handleAnalyze(imageSrc);
            }
        }
    }, [handleAnalyze]);


    // 切换闪光灯（必须在 reset 和 toggleCamera 之前定义）
    const toggleFlash = useCallback(async (forceState?: boolean) => {
        const videoTrack = videoTrackRef.current;
        if (!videoTrack) return;

        const newState = forceState !== undefined ? forceState : !flashEnabled;
        
        try {
            // 优先使用 MediaStreamTrack 的 torch 方法（现代浏览器支持）
            if ('torch' in videoTrack && typeof (videoTrack as any).torch === 'function') {
                await (videoTrack as any).torch(newState);
                setFlashEnabled(newState);
            } else if ('applyConstraints' in videoTrack) {
                // 备用方案：尝试使用 applyConstraints
                try {
                    const constraints = {
                        advanced: [{ torch: newState } as any]
                    } as unknown as MediaTrackConstraints;
                    
                    await videoTrack.applyConstraints(constraints);
                    setFlashEnabled(newState);
                } catch {
                    // 如果 applyConstraints 不支持 torch，尝试直接设置属性
                    if ((videoTrack as any).torch !== undefined) {
                        (videoTrack as any).torch = newState;
                        setFlashEnabled(newState);
                    } else {
                        message.warning(t('aiScanner.flashNotSupported'));
                        setFlashSupported(false);
                    }
                }
            } else {
                message.warning(t('aiScanner.flashNotSupported'));
                setFlashSupported(false);
            }
        } catch (error: any) {
            // 如果错误是因为不支持，隐藏闪光灯按钮
            if (error?.name === 'NotSupportedError' || error?.name === 'NotReadableError') {
                setFlashSupported(false);
                message.warning(t('aiScanner.flashNotSupported'));
            } else {
                message.error(t('aiScanner.flashToggleFailed'));
            }
        }
    }, [flashEnabled]);

    const toggleCamera = () => {
        // 切换摄像头前先关闭闪光灯
        if (flashEnabled) {
            toggleFlash(false);
        }
        setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
        setCameraError(null);
        setFlashSupported(false); // 重置支持状态，等摄像头启动后重新检测
    };

    const reset = () => {
        // 重置时关闭闪光灯
        if (flashEnabled) {
            toggleFlash(false);
        }
        setImgSrc(null);
        setResult(null);
        setAggregatedData(null); // 重置聚合数据
        setSaveStatus(null);
        setUserHint(''); // 重置用户提示
        setMatchedCigars([]); // 重置匹配的雪茄
    };

    // 保存截图功能
    const handleSaveScreenshot = async () => {
        if (!screenshotContainerRef.current) {
            message.error(t('common.screenshotSaveFailed'));
            return;
        }

        setSavingScreenshot(true);
        try {
            const html2canvas = (await import('html2canvas')).default;
            const canvas = await html2canvas(screenshotContainerRef.current, {
                backgroundColor: '#1a1a1a',
                scale: 2, // 提高清晰度
                useCORS: true,
                logging: false,
            });

            // 创建下载链接
            const link = document.createElement('a');
            const fileName = `AI识笳_${result?.brand}_${result?.name}_${Date.now()}.png`;
            link.download = fileName;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            message.success(t('common.screenshotSaved'));
        } catch (error) {
            message.error(t('common.screenshotSaveFailed'));
        } finally {
            setSavingScreenshot(false);
        }
    };

    // 分享截图功能
    const handleShareScreenshot = async () => {
        if (!screenshotContainerRef.current) {
            message.error(t('common.screenshotSaveFailed'));
            return;
        }

        setSavingScreenshot(true);
        try {
            const html2canvas = (await import('html2canvas')).default;
            const canvas = await html2canvas(screenshotContainerRef.current, {
                backgroundColor: '#1a1a1a',
                scale: 2,
                useCORS: true,
                logging: false,
            });

            // 将 canvas 转换为 blob
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    message.error(t('common.screenshotSaveFailed'));
                    setSavingScreenshot(false);
                    return;
                }

                const fileName = `AI识笳_${result?.brand}_${result?.name}_${Date.now()}.png`;
                const file = new File([blob], fileName, { type: 'image/png' });

                // 检查是否支持 Web Share API
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `AI识笳 - ${result?.brand} ${result?.name}`,
                            text: `识别结果：${result?.brand} ${result?.name}\n可信度：${Math.round((result?.confidence || 0) * 100)}%`,
                            files: [file],
                        });
                        message.success(t('common.shareSuccess'));
                    } catch (shareError: any) {
                        // 用户取消分享或其他错误
                        if (shareError.name !== 'AbortError') {
                            // 如果分享失败，回退到下载
                            handleSaveScreenshot();
                        }
                    }
                } else {
                    // 不支持 Web Share API，回退到下载
                    message.info(t('common.shareNotSupported'));
                    handleSaveScreenshot();
                }
                setSavingScreenshot(false);
            }, 'image/png');
        } catch (error) {
            message.error(t('common.shareFailed'));
            setSavingScreenshot(false);
        }
    };

    // 组件卸载时清理
    useEffect(() => {
        return () => {
            // 清理时关闭闪光灯和停止视频流
            if (flashEnabled && videoTrackRef.current) {
                toggleFlash(false);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            videoTrackRef.current = null;
        };
    }, [flashEnabled, toggleFlash]);

    const handleFileUpload: UploadProps['beforeUpload'] = (file) => {
        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            message.error(t('upload.selectImageFile'));
            return false;
        }

        // 验证文件大小（限制为 10MB）
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            message.error(t('aiScanner.imageTooLarge'));
            return false;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (result) {
                setImgSrc(result);
                handleAnalyze(result);
            }
        };
        reader.onerror = () => {
            message.error(t('aiScanner.readImageFailed'));
        };
        reader.readAsDataURL(file);
        return false; // 阻止自动上传
    };

    // 处理文本搜索
    const handleTextSearch = async () => {
        if (!userHint || !userHint.trim()) {
            message.warning(t('aiScanner.pleaseInputBrandAndName'));
            return;
        }
        
        setAnalyzing(true);
        setResult(null);
        setImgSrc(null); // 清空图片
        
        try {
            const searchResult = await searchCigarByText(userHint);
            
            if (searchResult) {
                setResult(searchResult);
                message.success(t('aiScanner.searchSuccess'));
                
                // 更新用户 AI 识茄使用统计
                if (user?.id) {
                    incrementUserCigarScanCount(user.id);
                }
                
                // 如果找到图片URL，设置为显示图片
                if (searchResult.imageUrl) {
                    setImgSrc(searchResult.imageUrl);
                }
                
                // 如果启用数据存储，保存结果（与图像搜索相同的存储机制）
                if (dataStorageEnabled) {
                    try {
                        console.log('[AICigarScanner] 文本搜索 - 准备保存到数据库:', { 
                            brand: searchResult.brand, 
                            name: searchResult.name,
                            userId: user?.id,
                            userName: user?.displayName,
                            hasDescription: !!searchResult.description
                        });
                        
                        // 传递用户信息（与图像搜索一致）
                        await saveRecognitionToCigarDatabase(
                            searchResult,
                            user?.id,
                            user?.displayName || undefined
                        );
                        
                        console.log('[AICigarScanner] 文本搜索 - 保存成功');
                        
                        // 保存后立即查询聚合数据（与图像搜索一致）
                        const productName = generateProductName(searchResult.brand, searchResult.name);
                        const aggregated = await getAggregatedCigarData(productName);
                        
                        if (aggregated) {
                            setAggregatedData(aggregated);
                            message.success(t('aiScanner.recognitionSuccessWithStats', { count: aggregated.totalRecognitions }));
                        }
                    } catch (error) {
                        console.error('[AICigarScanner] 文本搜索 - 保存失败:', error);
                        message.warning(t('aiScanner.statsUpdateFailed'));
                    }
                } else {
                    console.log('[AICigarScanner] 文本搜索 - 数据存储已禁用');
                }
            } else {
                message.error(t('aiScanner.noMatchFound'));
            }
        } catch (error) {
            message.error(t('aiScanner.searchFailed'));
        } finally {
            setAnalyzing(false);
        }
    };

    const handleUserMediaError = useCallback((error: string | DOMException) => {
        // 如果后置摄像头失败，尝试前置摄像头
        if (facingMode === 'environment') {
            setFacingMode('user');
            setCameraError(t('aiScanner.backCameraFallback'));
            message.warning(t('aiScanner.backCameraFallback'));
        } else {
            const errorMessage = typeof error === 'string' ? error : error.message || t('aiScanner.cameraUnavailable');
            setCameraError(errorMessage);
            message.error(t('aiScanner.cameraPermissionError'));
        }
    }, [facingMode]);

    const handleUserMedia = useCallback((stream: MediaStream) => {
        // 摄像头成功启动，清除错误
        setCameraError(null);
        
        // 保存 stream 引用以便控制闪光灯和对焦
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        videoTrackRef.current = videoTrack;
        
        if (videoTrack) {
            try {
                const capabilities = (videoTrack as any).getCapabilities?.();
                
                // 检查是否支持闪光灯（需要后置摄像头且支持 torch 模式）
                if (facingMode === 'environment') {
                    const hasTorch = capabilities?.torch || false;
                    setFlashSupported(hasTorch);
                    if (!hasTorch) {
                        setFlashEnabled(false);
                    }
                } else {
                    // 前置摄像头不支持闪光灯
                    setFlashSupported(false);
                    setFlashEnabled(false);
                }
                
            } catch (error) {
                // 如果获取 capabilities 失败，假设不支持
                setFlashSupported(false);
                setFlashEnabled(false);
            }
        }
    }, [facingMode]);

    // 视频约束配置
    const videoConstraints = facingMode === 'environment' 
        ? { facingMode: 'environment' } // 不使用 exact，允许回退
        : { facingMode: 'user' };
    const displayRating = typeof result?.rating === 'number' && Number.isFinite(result.rating)
        ? Math.min(100, Math.max(0, Math.round(result.rating)))
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center' }}>
            {/* 手动输入雪茄型号（可选） - 只在无图片且无结果时显示 */}
            {!imgSrc && !result && (
                <Card 
                    style={{ 
                        width: '100%', 
                        marginBottom: '16px', 
                        background: 'rgba(255,255,255,0.05)', 
                        border: '1px solid #333' 
                    }}
                    size="small"
                >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <EditOutlined style={{ color: '#ffd700' }} />
                            <Text style={{ color: '#fff', fontSize: '14px', fontWeight: 500 }}>
                                    {t('aiScanner.inputCigarModel')}
                            </Text>
                            </div>
                            {userHint && userHint.trim() && (
                                <Button
                                    type="primary"
                                    size="small"
                                    icon={<SearchOutlined />}
                                    onClick={handleTextSearch}
                                    loading={analyzing}
                                    style={{
                                        background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                                        border: 'none',
                                        color: '#111'
                                    }}
                                >
                                    {t('aiScanner.directSearch')}
                                </Button>
                            )}
                        </div>
                        <AutoComplete
                            style={{ width: '100%' }}
                            placeholder={t('aiScanner.inputPlaceholder')}
                            value={userHint}
                            onChange={setUserHint}
                            onSelect={(value) => setUserHint(value)}
                            options={filterOptions(userHint)}
                            filterOption={false}
                            allowClear
                            disabled={analyzing || loadingSuggestions}
                            notFoundContent={loadingSuggestions ? <Spin size="small" /> : null}
                        />
                        {userHint && (
                            <Text type="secondary" style={{ fontSize: '12px', color: '#aaa' }}>
                                {t('aiScanner.inputHint')}
                            </Text>
                        )}
                    </Space>
                </Card>
            )}
            
            {!imgSrc && !result && !analyzing ? (
                <div style={{ position: 'relative', width: '100%', height: '300px', background: '#000', borderRadius: '12px', overflow: 'hidden' }}>
                    {cameraError ? (
                        <div style={{ 
                            width: '100%', 
                            height: '100%', 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            color: '#fff',
                            padding: '20px',
                            textAlign: 'center'
                        }}>
                            <CameraOutlined style={{ fontSize: 48, marginBottom: 16, color: '#ff4d4f' }} />
                            <Text style={{ color: '#fff', marginBottom: 8 }}>{cameraError}</Text>
                            <Button 
                                type="primary" 
                                onClick={() => {
                                    setCameraError(null);
                                    setFacingMode(facingMode === 'environment' ? 'user' : 'environment');
                                }}
                                style={{ marginTop: 8 }}
                            >
                                {t('common.retry')}
                            </Button>
                        </div>
                    ) : (
                        <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            videoConstraints={videoConstraints}
                            onUserMedia={handleUserMedia}
                            onUserMediaError={handleUserMediaError}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    )}
                    <div style={{
                        position: 'absolute',
                        bottom: '20px',
                        left: '0',
                        right: '0',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <Button
                            type="default"
                            shape="circle"
                            icon={<SwapOutlined style={{ fontSize: '20px' }} />}
                            size="large"
                            style={{ 
                                width: '48px', 
                                height: '48px', 
                                background: 'rgba(0,0,0,0.6)',
                                border: '2px solid rgba(255,255,255,0.3)',
                                color: '#fff'
                            }}
                            onClick={toggleCamera}
                            title={facingMode === 'environment' ? t('aiScanner.switchToFront') : t('aiScanner.switchToBack')}
                        />
                        {flashSupported && facingMode === 'environment' && (
                            <Button
                                type={flashEnabled ? 'primary' : 'default'}
                                shape="circle"
                                icon={flashEnabled ? <ThunderboltFilled style={{ fontSize: '20px' }} /> : <ThunderboltOutlined style={{ fontSize: '20px' }} />}
                                size="large"
                                style={{ 
                                    width: '48px', 
                                    height: '48px', 
                                    background: flashEnabled 
                                        ? 'rgba(255, 215, 0, 0.8)' 
                                        : 'rgba(0,0,0,0.6)',
                                    border: flashEnabled 
                                        ? '2px solid rgba(255, 215, 0, 0.9)' 
                                        : '2px solid rgba(255,255,255,0.3)',
                                    color: flashEnabled ? '#111' : '#fff'
                                }}
                                onClick={() => toggleFlash()}
                                title={flashEnabled ? t('aiScanner.flashOff') : t('aiScanner.flashOn')}
                            />
                        )}
                        <Button
                            type="primary"
                            shape="circle"
                            icon={<CameraOutlined style={{color:'#111', fontSize: '24px' }} />}
                            size="large"
                            style={{ 
                                width: '64px', 
                                height: '64px', 
                                background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                                boxShadow: '0 4px 16px rgba(255, 215, 0, 0.3)'
                            }}
                            onClick={capture}
                        />
                        <Upload
                            accept="image/*"
                            beforeUpload={handleFileUpload}
                            showUploadList={false}
                        >
                            <Button
                                type="default"
                                shape="circle"
                                icon={<UploadOutlined style={{ fontSize: '20px' }} />}
                                size="large"
                                style={{ 
                                    width: '48px', 
                                    height: '48px', 
                                    background: 'rgba(0,0,0,0.6)',
                                    border: '2px solid rgba(255,255,255,0.3)',
                                    color: '#fff'
                                }}
                                title={t('aiScanner.uploadImage')}
                            />
                        </Upload>
                    </div>
                </div>
            ) : null}

            {/* 全屏加载动画 */}
                    {analyzing && (
                        <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: '12px',
                    background: 'rgba(0,0,0,0.95)', 
                    display: 'flex', 
                    flexDirection: 'column',
                    alignItems: 'center', 
                    justifyContent: 'center',
                    zIndex: 9999
                        }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 64, color: '#ffd700' }} spin />} />
                    <Text style={{ color: '#fff', marginTop: 24, fontSize: '18px', fontWeight: 500 }}>
                        {imgSrc ? t('aiScanner.analyzingImage') : t('aiScanner.analyzingText')}
                    </Text>
                </div>
            )}

            {(result && !analyzing) && (
                <>
                    {/* 截图容器：包含图片和识别结果（不包括按钮） */}
                    <div ref={screenshotContainerRef} style={{ width: '100%'}}>
                        <Card 
                            style={{ width: '100%', marginTop: '16px', background: 'rgba(255,255,255,0.05)', border: '1px solid #333' }}
                            bodyStyle={{ padding: '16px' }}
                        >
                            <Space direction="vertical" style={{ width: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <div style={{ flex: 1 }}>
                                <Title level={4} style={{ margin: 0, color: '#ffd700' }}>{result!.brand}</Title>
                                <Text style={{ fontSize: '16px', color: '#fff' }}>{result!.name}</Text>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                                <Tag color={result!.strength === 'Full' ? 'red' : result!.strength === 'Medium' ? 'orange' : 'green'}>
                                    {result!.strength}
                                </Tag>
                                {displayRating ? (
                                    <Tag 
                                        color="gold"
                                        style={{ 
                                            margin: 0,
                                            width: '60px',
                                            height: '60px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'linear-gradient(135deg, #FDE08D, #C48D3A)',
                                            border: '1px solid rgba(184, 134, 11, 0.6)',
                                            color: '#1a1a1a',
                                            fontWeight: 1000,
                                            fontSize: '28px',
                                            padding: 0,
                                            borderRadius: '12px'
                                        }}
                                    >
                                        {displayRating}
                                    </Tag>
                                ) : null}
                            </div>
                        </div>

                        {/* 雪茄茄标图像 - 优先使用 Gemini 返回的图片，否则使用用户拍摄的图片 */}
                        {(result!.imageUrl || imgSrc) && (() => {
                            const displayImageUrl = result!.imageUrl || imgSrc;
                            return (
                                <div style={{ 
                                    marginTop: '12px',
                                    background: 'rgba(0,0,0,0.2)', 
                                    padding: '12px', 
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <Text type="secondary" style={{ 
                                        fontSize: '13px', 
                                        display: 'block', 
                                        marginBottom: '12px',
                                        fontWeight: 500,
                                        color: '#ffd700'
                                    }}>
                                        {t('aiScanner.cigarBandImage')}
                                    </Text>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        width: '100%',
                                        maxHeight: '200px',
                                        borderRadius: '8px',
                                        overflow: 'hidden'
                                    }}>
                                        <img 
                                            src={displayImageUrl || ''} 
                                            alt="雪茄茄标" 
                                            style={{ 
                                                width: '100%', 
                                                maxHeight: '200px', 
                                                objectFit: 'contain',
                                                borderRadius: '8px'
                                            }}
                                            onError={(e) => {
                                                // 如果 Gemini 返回的图片加载失败，回退到用户拍摄的图片
                                                if (result!.imageUrl && imgSrc && e.currentTarget.src !== imgSrc) {
                                                    e.currentTarget.src = imgSrc;
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })()}

                        <Divider style={{ margin: '12px 0', borderColor: '#333' }} />

                        {/* 显示统计信息（如果有聚合数据） */}
                        {aggregatedData && aggregatedData.totalRecognitions > 1 && (
                            <div style={{ 
                                marginBottom: '12px', 
                                padding: '8px 12px',
                                background: 'rgba(255, 215, 0, 0.1)',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 215, 0, 0.3)'
                            }}>
                                <Text style={{ color: '#ffd700', fontSize: '12px' }}>
                                    {t('aiScanner.dataSource', { count: aggregatedData.totalRecognitions })}
                                </Text>
                            </div>
                        )}

                        <Space split={<Divider type="vertical" style={{ borderColor: '#555' }} />}>
                            <Text style={{ color: '#ddd' }} type="secondary">
                                {t('inventory.origin')}: <span style={{ color: '#ddd' }}>
                                    {aggregatedData ? aggregatedData.origin : result!.origin}
                                    {aggregatedData && aggregatedData.originConsistency < 100 && (
                                        <Text type="secondary" style={{ color: '#999', fontSize: '11px', marginLeft: 4 }}>
                                            ({aggregatedData.originConsistency.toFixed(0)}%一致)
                                        </Text>
                                    )}
                                </span>
                            </Text>
                            <Text style={{ color: '#ddd' }} type="secondary">{t('aiScanner.confidenceLabel')}: <span style={{ color: '#ddd' }}>{Math.round(result!.confidence * 100)}%</span></Text>
                        </Space>

                        {/* 风味特征：优先使用聚合数据（Top 10） */}
                        <div style={{ marginTop: '8px' }}>
                            {aggregatedData && aggregatedData.flavorProfile.length > 0 ? (
                                // 显示聚合的 Top 10 风味
                                aggregatedData.flavorProfile.map((item, index) => (
                                    <Tag 
                                        key={item.value} 
                                        color="gold" 
                                        style={{ marginRight: '4px', marginBottom: '4px' }}
                                    >
                                        {item.value}
                                        {aggregatedData.totalRecognitions > 1 && (
                                            <span style={{ fontSize: '10px', marginLeft: 4, opacity: 0.8 }}>
                                                x{item.count}
                                            </span>
                                        )}
                                    </Tag>
                                ))
                            ) : (
                                // 回退到单次识别结果
                                result!.flavorProfile.map(flavor => (
                                <Tag key={flavor} color="gold" style={{ marginRight: '4px', marginBottom: '4px' }}>{flavor}</Tag>
                                ))
                            )}
                        </div>

                        {((aggregatedData && (aggregatedData.wrappers.length > 0 || aggregatedData.binders.length > 0 || aggregatedData.fillers.length > 0)) || 
                          (result!.wrapper || result!.binder || result!.filler)) && (
                            <>
                                <Divider style={{ margin: '6px 0', borderColor: '#333' }} />
                                <div style={{ 
                                    marginTop: '4px', 
                                    background: 'rgba(0,0,0,0.2)', 
                                    padding: '12px', 
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <Text type="secondary" style={{ 
                                        fontSize: '13px', 
                                        display: 'block', 
                                        marginBottom: '12px',
                                        fontWeight: 500,
                                        color: '#ffd700'
                                    }}>
                                        {t('aiScanner.cigarConstruction')} {aggregatedData && aggregatedData.totalRecognitions > 1 && (
                                            <span style={{ fontSize: '11px', color: '#999' }}>
                                                {t('aiScanner.top5Stats')}
                                            </span>
                                        )}
                                    </Text>
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                        {/* 茄衣 */}
                                        {(aggregatedData && aggregatedData.wrappers.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: 4 }}>
                                                    {t('aiScanner.wrapper')}
                                                </Text>
                                                {aggregatedData.wrappers.map((item, index) => (
                                                    <div key={index} style={{ marginLeft: 8, marginBottom: 2 }}>
                                                        <Text style={{ color: '#ddd', fontSize: '11px' }}>
                                                            {index + 1}. {item.value}
                                                            <span style={{ color: '#999', marginLeft: 4 }}>
                                                                (x{item.count}, {item.percentage.toFixed(0)}%)
                                                            </span>
                                                        </Text>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : result!.wrapper && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', minWidth: '80px' }}>{t('aiScanner.wrapperPlain')}</Text>
                                                <Text style={{ color: '#ddd', fontSize: '12px', textAlign: 'right', flex: 1 }}>{result!.wrapper}</Text>
                                            </div>
                                        )}
                                        
                                        {/* 茄套 */}
                                        {(aggregatedData && aggregatedData.binders.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: 4 }}>
                                                    {t('aiScanner.binder')}
                                                </Text>
                                                {aggregatedData.binders.map((item, index) => (
                                                    <div key={index} style={{ marginLeft: 8, marginBottom: 2 }}>
                                                        <Text style={{ color: '#ddd', fontSize: '11px' }}>
                                                            {index + 1}. {item.value}
                                                            <span style={{ color: '#999', marginLeft: 4 }}>
                                                                (x{item.count}, {item.percentage.toFixed(0)}%)
                                                            </span>
                                                        </Text>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : result!.binder && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', minWidth: '80px' }}>{t('aiScanner.binderPlain')}</Text>
                                                <Text style={{ color: '#ddd', fontSize: '12px', textAlign: 'right', flex: 1 }}>{result!.binder}</Text>
                                            </div>
                                        )}
                                        
                                        {/* 茄芯 */}
                                        {(aggregatedData && aggregatedData.fillers.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: 4 }}>
                                                    {t('aiScanner.filler')}
                                                </Text>
                                                {aggregatedData.fillers.map((item, index) => (
                                                    <div key={index} style={{ marginLeft: 8, marginBottom: 2 }}>
                                                        <Text style={{ color: '#ddd', fontSize: '11px' }}>
                                                            {index + 1}. {item.value}
                                                            <span style={{ color: '#999', marginLeft: 4 }}>
                                                                (x{item.count}, {item.percentage.toFixed(0)}%)
                                                            </span>
                                                        </Text>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : result!.filler && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', minWidth: '80px' }}>{t('aiScanner.fillerPlain')}</Text>
                                                <Text style={{ color: '#ddd', fontSize: '12px', textAlign: 'right', flex: 1 }}>{result!.filler}</Text>
                                            </div>
                                        )}
                                    </Space>
                                </div>
                            </>
                        )}

                        {((aggregatedData && (aggregatedData.footTasteNotes.length > 0 || aggregatedData.bodyTasteNotes.length > 0 || aggregatedData.headTasteNotes.length > 0)) ||
                          (result!.footTasteNotes?.length || result!.bodyTasteNotes?.length || result!.headTasteNotes?.length)) && (
                            <>
                                <Divider style={{ margin: '6px 0', borderColor: '#333' }} />
                                <div style={{ 
                                    marginTop: '4px', 
                                    background: 'rgba(0,0,0,0.2)', 
                                    padding: '12px', 
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <Text type="secondary" style={{ 
                                        fontSize: '13px', 
                                        display: 'block', 
                                        marginBottom: '12px',
                                        fontWeight: 500,
                                        color: '#ffd700'
                                    }}>
                                        {t('aiScanner.tastingNotes')} {aggregatedData && aggregatedData.totalRecognitions > 1 && (
                                            <span style={{ fontSize: '11px', color: '#999' }}>
                                                {t('aiScanner.top5Stats')}
                                            </span>
                                        )}
                                    </Text>
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                        {/* 头段品吸笔记：优先使用聚合数据 Top 5 */}
                                        {(aggregatedData && aggregatedData.footTasteNotes.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.footSection')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {aggregatedData.footTasteNotes.map((item, index) => (
                                                        <Tag key={index} color="cyan" style={{ fontSize: '11px', margin: 0 }}>
                                                            {item.value}
                                                            {aggregatedData.totalRecognitions > 1 && (
                                                                <span style={{ fontSize: '10px', marginLeft: 2, opacity: 0.8 }}>
                                                                    x{item.count}
                                                                </span>
                                                            )}
                                                        </Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (result!.footTasteNotes && Array.isArray(result!.footTasteNotes) && result!.footTasteNotes.length > 0) && (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.footSectionPlain')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {result!.footTasteNotes.map((note: string, index: number) => (
                                                        <Tag key={index} color="cyan" style={{ fontSize: '11px', margin: 0 }}>{note}</Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {/* 中段品吸笔记：优先使用聚合数据 Top 5 */}
                                        {(aggregatedData && aggregatedData.bodyTasteNotes.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.bodySection')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {aggregatedData.bodyTasteNotes.map((item, index) => (
                                                        <Tag key={index} color="blue" style={{ fontSize: '11px', margin: 0 }}>
                                                            {item.value}
                                                            {aggregatedData.totalRecognitions > 1 && (
                                                                <span style={{ fontSize: '10px', marginLeft: 2, opacity: 0.8 }}>
                                                                    x{item.count}
                                                                </span>
                                                            )}
                                                        </Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (result!.bodyTasteNotes && Array.isArray(result!.bodyTasteNotes) && result!.bodyTasteNotes.length > 0) && (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.bodySectionPlain')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {result!.bodyTasteNotes.map((note: string, index: number) => (
                                                        <Tag key={index} color="blue" style={{ fontSize: '11px', margin: 0 }}>{note}</Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {/* 尾段品吸笔记：优先使用聚合数据 Top 5 */}
                                        {(aggregatedData && aggregatedData.headTasteNotes.length > 0) ? (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.headSection')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {aggregatedData.headTasteNotes.map((item, index) => (
                                                        <Tag key={index} color="purple" style={{ fontSize: '11px', margin: 0 }}>
                                                            {item.value}
                                                            {aggregatedData.totalRecognitions > 1 && (
                                                                <span style={{ fontSize: '10px', marginLeft: 2, opacity: 0.8 }}>
                                                                    x{item.count}
                                                                </span>
                                                            )}
                                                        </Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (result!.headTasteNotes && Array.isArray(result!.headTasteNotes) && result!.headTasteNotes.length > 0) && (
                                            <div>
                                                <Text type="secondary" style={{ color: '#ddd', fontSize: '12px', display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                                                    {t('aiScanner.headSectionPlain')}
                                                </Text>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {result!.headTasteNotes.map((note: string, index: number) => (
                                                        <Tag key={index} color="purple" style={{ fontSize: '11px', margin: 0 }}>{note}</Tag>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </Space>
                                </div>
                            </>
                        )}

                        <Paragraph style={{ color: '#aaa', marginTop: '6px', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '4px' }}>
                            {result!.description}
                        </Paragraph>

                        {/* 显示匹配雪茄的图片 */}
                        {(() => {
                            // 优先使用 saveStatus 中的 cigars，否则使用 matchedCigars
                            const cigarsToShow = saveStatus?.cigars && saveStatus.cigars.length > 0 
                                ? saveStatus.cigars 
                                : matchedCigars;
                            
                            if (!cigarsToShow || cigarsToShow.length === 0) {
                                return null;
                            }
                            
                            // 收集所有雪茄的图片（最多5张）
                            // 过滤掉无效的图片 URL（如 404 的 Cloudinary 图片）
                            const allImages: string[] = [];
                            cigarsToShow.forEach(cigar => {
                                if (cigar.images && cigar.images.length > 0) {
                                    cigar.images.forEach(img => {
                                        if (img && 
                                            typeof img === 'string' && 
                                            img.trim().length > 0 &&
                                            !allImages.includes(img) && 
                                            allImages.length < 5) {
                                            // 基本验证：确保是有效的 URL
                                            try {
                                                new URL(img);
                                                allImages.push(img);
                                            } catch {
                                                // 如果不是完整 URL，可能是相对路径，也允许
                                                if (img.startsWith('http') || img.startsWith('//') || img.startsWith('/')) {
                                                    allImages.push(img);
                                                }
                                            }
                                        }
                                    });
                                }
                            });

                            if (allImages.length > 0) {
                                return (
                                    <>
                                        <Divider style={{ margin: '12px 0', borderColor: '#333' }} />
                                        <div style={{ 
                                            marginTop: '4px', 
                                            background: 'rgba(0,0,0,0.2)', 
                                            padding: '12px', 
                                            borderRadius: '8px',
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}>
                                            <Text type="secondary" style={{ 
                                                fontSize: '13px', 
                                                display: 'block', 
                                                marginBottom: '12px',
                                                fontWeight: 500,
                                                color: '#ffd700'
                                            }}>
                                                {t('aiScanner.cigarImages', { count: allImages.length })}
                                            </Text>
                                            <Image.PreviewGroup>
                                                <div style={{ 
                                                    display: 'grid', 
                                                    gridTemplateColumns: `repeat(${Math.min(allImages.length, 3)}, 1fr)`,
                                                    gap: '8px'
                                                }}>
                                                    {allImages.map((imgUrl, index) => (
                                                        <div 
                                                            key={index}
                                                            style={{
                                                                position: 'relative',
                                                                width: '100%',
                                                                aspectRatio: '1',
                                                                borderRadius: '8px',
                                                                overflow: 'hidden',
                                                                background: '#000',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            <Image
                                                                src={imgUrl}
                                                                alt={`${t('aiScanner.cigarImage')} ${index + 1}`}
                                                                style={{
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    objectFit: 'cover'
                                                                }}
                                                                preview={{
                                                                    mask: t('aiScanner.imagePreviewMask')
                                                                }}
                                                                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NjY2NjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7lm77niYfliqDovb3lpLHotKU8L3RleHQ+PC9zdmc+"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </Image.PreviewGroup>
                                        </div>
                                    </>
                                );
                            }
                            return null;
                        })()}
                            </Space>
                        </Card>
                    </div>

                    {/* 操作按钮区域：不在截图中 */}
                    <Space direction="vertical" style={{ width: '100%', marginTop: '12px' }} size="middle">
                        {saving && (
                            <div style={{
                                padding: '12px',
                                background: 'rgba(24, 144, 255, 0.1)',
                                border: '1px solid #1890ff',
                                borderRadius: '8px',
                                textAlign: 'center'
                            }}>
                                <Spin size="small" style={{ marginRight: 8 }} />
                                <Text style={{ color: '#1890ff', fontSize: '13px' }}>{t('aiScanner.savingToDb')}</Text>
                            </div>
                        )}
                        {savingScreenshot && (
                            <div style={{
                                padding: '12px',
                                background: 'rgba(24, 144, 255, 0.1)',
                                border: '1px solid #1890ff',
                                borderRadius: '8px',
                                textAlign: 'center'
                            }}>
                                <Spin size="small" style={{ marginRight: 8 }} />
                                <Text style={{ color: '#1890ff', fontSize: '13px' }}>{t('aiScanner.generatingScreenshot')}</Text>
                            </div>
                        )}
                        
                        {/* 截图保存和分享按钮 */}
                        <Button 
                            block
                            icon={<DownloadOutlined />}
                            onClick={handleSaveScreenshot}
                            loading={savingScreenshot}
                            disabled={savingScreenshot || saving}
                            style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: '#fff'
                            }}
                        >
                            {t('common.saveScreenshot')}
                        </Button>
                        <Button 
                            block
                            icon={<ShareAltOutlined />}
                            onClick={handleShareScreenshot}
                            loading={savingScreenshot}
                            disabled={savingScreenshot || saving}
                            style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: '#fff'
                            }}
                        >
                            {t('common.shareScreenshot')}
                        </Button>
                        
                        <Button 
                            block 
                            icon={<ReloadOutlined />} 
                            onClick={reset}
                            loading={saving}
                            disabled={saving || savingScreenshot}
                            style={{
                                background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                                color: '#111',
                                fontWeight: 600,
                                boxShadow: '0 4px 16px rgba(255, 215, 0, 0.3)'
                            }}
                        >
                            {t('aiScanner.retake')}
                        </Button>
                    </Space>
                </>
            )}

            {imgSrc && !result && !analyzing && (
                <Button 
                    block 
                    icon={<ReloadOutlined />} 
                    onClick={reset} 
                    style={{ 
                        marginTop: 16,
                        background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                        border: 'none',
                        color: '#111',
                        fontWeight: 600,
                        boxShadow: '0 4px 16px rgba(255, 215, 0, 0.3)'
                    }}
                >
                    {t('aiScanner.retake')}
                </Button>
            )}
        </div>
    );
};

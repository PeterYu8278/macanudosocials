/**
 * 表单 Hook
 * 提供统一的表单逻辑（验证、提交、重置）
 */

import { useState, useCallback } from 'react'
import { Form, App } from 'antd'
import type { FormInstance } from 'antd'

/**
 * 表单配置
 */
export interface UseFormConfig<T = any> {
  /** 初始值 */
  initialValues?: Partial<T>
  /** 提交函数 */
  onSubmit?: (values: T) => Promise<void> | void
  /** 提交成功回调 */
  onSuccess?: (values: T) => void
  /** 提交失败回调 */
  onError?: (error: any) => void
  /** 自定义验证规则 */
  validate?: (values: T) => Promise<Record<string, string> | null> | Record<string, string> | null
  /** 是否显示成功提示 */
  showSuccessMessage?: boolean
  /** 成功提示文字 */
  successMessage?: string
  /** 是否显示错误提示 */
  showErrorMessage?: boolean
}

/**
 * 表单状态
 */
export interface UseFormState<T = any> {
  /** 表单实例 */
  form: FormInstance<T>
  /** 表单值 */
  values: Partial<T>
  /** 提交中状态 */
  submitting: boolean
  /** 验证错误 */
  errors: Record<string, string>
  /** 表单是否被修改 */
  isDirty: boolean
}

/**
 * 表单操作
 */
export interface UseFormActions<T = any> {
  /** 设置字段值 */
  setFieldValue: (field: keyof T, value: any) => void
  /** 设置多个字段值 */
  setFieldsValue: (values: Partial<T>) => void
  /** 获取字段值 */
  getFieldValue: (field: keyof T) => any
  /** 获取所有字段值 */
  getFieldsValue: () => T
  /** 验证表单 */
  validateForm: () => Promise<boolean>
  /** 验证单个字段 */
  validateField: (field: keyof T) => Promise<boolean>
  /** 提交表单 */
  submit: () => Promise<void>
  /** 重置表单 */
  reset: (values?: Partial<T>) => void
  /** 清空表单 */
  clear: () => void
}

/**
 * 表单 Hook 返回值
 */
export interface UseFormReturn<T = any> extends UseFormState<T>, UseFormActions<T> {}

/**
 * 表单 Hook
 * 
 * @example
 * ```tsx
 * const {
 *   form,
 *   submitting,
 *   submit,
 *   reset
 * } = useForm<UserFormData>({
 *   initialValues: { name: '', email: '' },
 *   onSubmit: async (values) => {
 *     await createUser(values)
 *   },
 *   onSuccess: () => {
 *     navigate('/users')
 *   },
 *   showSuccessMessage: true,
 *   successMessage: '用户创建成功'
 * })
 * 
 * <Form form={form} onFinish={submit}>
 *   <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
 *     <Input />
 *   </Form.Item>
 *   <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
 *     <Input />
 *   </Form.Item>
 *   <Button type="primary" htmlType="submit" loading={submitting}>
 *     提交
 *   </Button>
 * </Form>
 * ```
 */
export function useForm<T = any>(config: UseFormConfig<T> = {}): UseFormReturn<T> {
  const {
    initialValues = {},
    onSubmit,
    onSuccess,
    onError,
    validate,
    showSuccessMessage = true,
    successMessage = '操作成功',
    showErrorMessage = true
  } = config

  const { message } = App.useApp()
  // 创建表单实例
  const [form] = Form.useForm<T>()

  // 状态
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isDirty, setIsDirty] = useState(false)

  // 获取表单值
  const values = Form.useWatch([], form) || initialValues

  /**
   * 设置字段值
   */
  const setFieldValue = useCallback(
    (field: keyof T, value: any) => {
      form.setFieldValue(field as any, value)
      setIsDirty(true)
    },
    [form]
  )

  /**
   * 设置多个字段值
   */
  const setFieldsValue = useCallback(
    (values: Partial<T>) => {
      form.setFieldsValue(values as any)
      setIsDirty(true)
    },
    [form]
  )

  /**
   * 获取字段值
   */
  const getFieldValue = useCallback(
    (field: keyof T) => {
      return form.getFieldValue(field as any)
    },
    [form]
  )

  /**
   * 获取所有字段值
   */
  const getFieldsValue = useCallback(() => {
    return form.getFieldsValue()
  }, [form])

  /**
   * 验证表单
   */
  const validateForm = useCallback(async (): Promise<boolean> => {
    try {
      // Ant Design 表单验证
      await form.validateFields()

      // 自定义验证
      if (validate) {
        const customErrors = await validate(form.getFieldsValue())
        if (customErrors && Object.keys(customErrors).length > 0) {
          setErrors(customErrors)
          return false
        }
      }

      setErrors({})
      return true
    } catch (error: any) {
      // 处理 Ant Design 验证错误
      if (error.errorFields) {
        const errorMap: Record<string, string> = {}
        error.errorFields.forEach((field: any) => {
          if (field.name && field.errors && field.errors.length > 0) {
            errorMap[field.name[0]] = field.errors[0]
          }
        })
        setErrors(errorMap)
      }
      return false
    }
  }, [form, validate])

  /**
   * 验证单个字段
   */
  const validateField = useCallback(
    async (field: keyof T): Promise<boolean> => {
      try {
        await form.validateFields([field as any])
        
        // 清除该字段的错误
        setErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors[field as string]
          return newErrors
        })
        
        return true
      } catch (error) {
        return false
      }
    },
    [form]
  )

  /**
   * 提交表单
   */
  const submit = useCallback(async () => {
    try {
      setSubmitting(true)

      // 验证表单
      const isValid = await validateForm()
      if (!isValid) {
        setSubmitting(false)
        return
      }

      // 获取表单值
      const formValues = form.getFieldsValue()

      // 执行提交
      if (onSubmit) {
        await onSubmit(formValues)
      }

      // 成功回调
      if (onSuccess) {
        onSuccess(formValues)
      }

      // 显示成功提示
      if (showSuccessMessage) {
        message.success(successMessage)
      }

      // 重置脏标记
      setIsDirty(false)
    } catch (error: any) {

      // 错误回调
      if (onError) {
        onError(error)
      }

      // 显示错误提示
      if (showErrorMessage) {
        message.error(error.message || '操作失败')
      }
    } finally {
      setSubmitting(false)
    }
  }, [
    form,
    validateForm,
    onSubmit,
    onSuccess,
    onError,
    showSuccessMessage,
    successMessage,
    showErrorMessage
  ])

  /**
   * 重置表单
   */
  const reset = useCallback(
    (values?: Partial<T>) => {
      form.resetFields()
      if (values) {
        form.setFieldsValue(values as any)
      } else if (initialValues) {
        form.setFieldsValue(initialValues as any)
      }
      setErrors({})
      setIsDirty(false)
    },
    [form, initialValues]
  )

  /**
   * 清空表单
   */
  const clear = useCallback(() => {
    form.resetFields()
    setErrors({})
    setIsDirty(false)
  }, [form])

  // 初始化表单值
  if (initialValues && Object.keys(initialValues).length > 0) {
    form.setFieldsValue(initialValues)
  }

  return {
    // 状态
    form,
    values,
    submitting,
    errors,
    isDirty,

    // 操作
    setFieldValue,
    setFieldsValue,
    getFieldValue,
    getFieldsValue,
    validateForm,
    validateField,
    submit,
    reset,
    clear
  }
}

/**
 * 表单字段 Hook
 * 用于简化单个字段的使用
 * 
 * @example
 * ```tsx
 * const { value, setValue, error, validate } = useFormField(form, 'email')
 * 
 * <Input
 *   value={value}
 *   onChange={(e) => setValue(e.target.value)}
 *   onBlur={validate}
 *   status={error ? 'error' : ''}
 * />
 * {error && <div style={{ color: 'red' }}>{error}</div>}
 * ```
 */
export function useFormField<T = any>(
  form: FormInstance<T>,
  fieldName: keyof T
) {
  const [error, setError] = useState<string>('')
  
  const value = Form.useWatch(fieldName as any, form)

  const setValue = useCallback(
    (newValue: any) => {
      form.setFieldValue(fieldName as any, newValue)
    },
    [form, fieldName]
  )

  const validate = useCallback(async () => {
    try {
      await form.validateFields([fieldName as any])
      setError('')
      return true
    } catch (err: any) {
      if (err.errorFields && err.errorFields[0]) {
        setError(err.errorFields[0].errors[0])
      }
      return false
    }
  }, [form, fieldName])

  return {
    value,
    setValue,
    error,
    validate
  }
}

